import { budgetReport, reserveRequest, settleRequest, AgentBudgetError } from "./agent-budget.js";
import { acceptConversationInput, readConversation } from "./conversation.js";
import { ConversationDTO } from "./conversation-contracts.js";
import { validateProposal } from "./agent-validation.js";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { randomUUID } from "node:crypto";
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import { PublicError } from "./app.js";
import { ErrorDTO, MutationHeaders } from "./contracts.js";
import { InputDTO, QueuedDTO, RunDTO, ModelDTO } from "./agent-contracts.js";
import { interpret, type ModelConfig } from "./pi-adapter.js";
export async function registerAgent(
  instance: FastifyInstance,
  ctx: {
    pool: pg.Pool;
    session: (
      authorization?: string,
    ) => Promise<{ ownerId: string; deviceId: string; sessionId: string }>;
    now: () => Date;
    admin: (authorization?: string) => void;
    model?: ModelConfig;
  },
) {
  const app = instance.withTypeProvider<TypeBoxTypeProvider>(),
    errors = {
      401: ErrorDTO,
      404: ErrorDTO,
      409: ErrorDTO,
      422: ErrorDTO,
      503: ErrorDTO,
    },
    security = [{ bearerAuth: [] }];
  app.get(
    "/v1/conversations/:id",
    {
      schema: {
        security,
        params: Type.Object({ id: Type.String({ format: "uuid" }) }),
        response: { 200: ConversationDTO, ...errors },
      },
    },
    async (req) => {
      const i = await ctx.session(req.headers.authorization);
      return readConversation(ctx.pool, i.ownerId, req.params.id);
    },
  );
  app.get(
    "/v1/model",
    { schema: { security, response: { 200: ModelDTO, ...errors } } },
    async (req) => {
      await ctx.session(req.headers.authorization);
      return {
        configured: !!ctx.model,
        provider: ctx.model ? "anthropic" : "",
        model: ctx.model?.model ?? "",
        dataDestination:
          ctx.model?.baseUrl ?? "尚未配置模型，不会发送内容到模型服务。",
      };
    },
  );
  app.get(
    "/v1/admin/model/budget",
    {
      schema: {
        security,
        response: {
          200: Type.Object(
            {
              day: Type.String(),
              timeZone: Type.Literal("UTC"),
              limitUsd: Type.Number(),
              requests: Type.Integer(),
              reservedUsd: Type.Number(),
              usageUsd: Type.Number(),
              unknownRequests: Type.Integer(),
              remainingUsd: Type.Number(),
              invoiceAvailable: Type.Literal(false),
            },
            { additionalProperties: false },
          ),
          ...errors,
        },
      },
    },
    async (req) => {
      ctx.admin(req.headers.authorization);
      return budgetReport(ctx.pool, ctx.now(), ctx.model?.dailyBudgetUsd ?? 1);
    },
  );
  app.post(
    "/v1/admin/model/test",
    {
      schema: {
        security,
        body: Type.Object({}, { additionalProperties: false }),
        response: {
          200: Type.Object({
            ok: Type.Boolean(),
            provider: Type.String(),
            model: Type.String(),
            requests: Type.Integer(),
            toolCalls: Type.Integer(),
          }),
          ...errors,
        },
      },
    },
    async (req) => {
      ctx.admin(req.headers.authorization);
      if (!ctx.model)
        throw new PublicError(
          503,
          "MODEL_NOT_CONFIGURED",
          "请先配置服务端模型密钥。",
        );
      let budgetDenied=false;
      const input = {
        ownerId: "00000000-0000-4000-8000-000000000001",
        inputId: randomUUID(),
        text: "明天上午9点提醒我检查测试事项",
        timeZone: "Asia/Shanghai",
        now: ctx.now().toISOString(),
        signal: AbortSignal.timeout(60000),
        beforeRequest: async (_context: unknown, maxTokens: number) => {
          try{return await reserveRequest(ctx.pool,null,0,ctx.model?.dailyBudgetUsd??1,maxTokens,ctx.now());}
          catch(e){if(e instanceof AgentBudgetError)budgetDenied=true;throw e;}
        },
        afterRequest: async (
          id: string,
          usage: {
            input: number;
            output: number;
            totalTokens: number;
            costTotal: number;
          },
        ) => settleRequest(ctx.pool, id, usage),
      };
      const r = await interpret(ctx.model, input);
      if(budgetDenied)throw new PublicError(409,"MODEL_BUDGET_EXHAUSTED","今日 AI 额度已用完（UTC 零点重置）。");
      return {
        ok:
          r.output.kind === "proposal" &&
          validateProposal(r.output.proposal, input),
        provider: "anthropic",
        model: ctx.model.model,
        requests: r.requests,
        toolCalls: r.toolCalls,
      };
    },
  );
  app.post(
    "/v1/inputs",
    {
      schema: {
        security,
        headers: MutationHeaders,
        body: InputDTO,
        response: { 202: QueuedDTO, ...errors },
      },
    },
    async (req, reply) => {
      const identity = await ctx.session(req.headers.authorization),
        b = req.body;
      try {
        new Intl.DateTimeFormat("en", { timeZone: b.timeZone });
      } catch {
        throw new PublicError(422, "INVALID_TIMEZONE", "请核对时区。");
      }
      if (!b.text.trim())
        throw new PublicError(422, "INVALID_INPUT", "请填写交代。");
      const c = await ctx.pool.connect();
      try {
        await c.query("BEGIN");
        await c.query("SELECT id FROM owner WHERE id=$1 FOR UPDATE", [
          identity.ownerId,
        ]);
        const old = (
          await c.query(
            "SELECT i.*,r.id AS run_id FROM input_event i JOIN agent_run r ON r.input_id=i.id WHERE i.owner_id=$1 AND i.device_id=$2 AND i.idempotency_key=$3",
            [
              identity.ownerId,
              identity.deviceId,
              req.headers["idempotency-key"],
            ],
          )
        ).rows[0];
        if (old) {
          if (
            old.text !== b.text ||
            old.time_zone !== b.timeZone ||
            (b.conversationId && old.conversation_id !== b.conversationId) ||
            (old.reply_to_input_id ?? undefined) !== b.replyToInputId ||
            (old.selected_task_id ?? undefined) !== b.taskId
          )
            throw new PublicError(
              409,
              "IDEMPOTENCY_CONFLICT",
              "相同操作标识的内容不同。",
            );
          await c.query("COMMIT");
          return reply.code(202).send({
            inputId: old.id,
            runId: old.run_id,
            conversationId: old.conversation_id,
            conversationRevision: old.conversation_revision,
          });
        }
        const inputId = randomUUID(),
          runId = randomUUID();
        const conversation = await acceptConversationInput(
          c,
          identity,
          b,
          ctx.now(),
        );
        await c.query(
          "INSERT INTO input_event(id,owner_id,device_id,session_id,idempotency_key,text,time_zone,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
          [
            inputId,
            identity.ownerId,
            identity.deviceId,
            identity.sessionId,
            req.headers["idempotency-key"],
            b.text,
            b.timeZone,
            ctx.now(),
          ],
        );
        await c.query(
          "UPDATE input_event SET conversation_id=$2,conversation_revision=$3,reply_to_input_id=$4,selected_task_id=$5 WHERE id=$1",
          [
            inputId,
            conversation.conversationId,
            conversation.conversationRevision,
            b.replyToInputId ?? null,
            b.taskId ?? null,
          ],
        );
        await c.query(
          "INSERT INTO agent_run(id,input_id,owner_id,status) VALUES($1,$2,$3,'queued')",
          [runId, inputId, identity.ownerId],
        );
        await c.query("COMMIT");
        return reply.code(202).send({ inputId, runId, ...conversation });
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
    },
  );
  app.post(
    "/v1/runs/:id/retry",
    {
      schema: {
        security,
        headers: MutationHeaders,
        params: Type.Object({ id: Type.String({ format: "uuid" }) }),
        body: Type.Object({}, { additionalProperties: false }),
        response: { 202: QueuedDTO, ...errors },
      },
    },
    async (req, reply) => {
      const i = await ctx.session(req.headers.authorization),
        c = await ctx.pool.connect();
      try {
        await c.query("BEGIN");
        const r = (
          await c.query(
            "SELECT * FROM agent_run WHERE id=$1 AND owner_id=$2 FOR UPDATE",
            [req.params.id, i.ownerId],
          )
        ).rows[0];
        if (!r)
          throw new PublicError(404, "RUN_NOT_FOUND", "此处理记录不存在。");
        const accepted = await c.query(
          "INSERT INTO agent_retry(run_id,idempotency_key) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING run_id",
          [r.id, req.headers["idempotency-key"]],
        );
        if (accepted.rowCount)
          await c.query(
            "UPDATE agent_run SET status='queued',message=NULL,started_at=NULL,finished_at=NULL,error_code=NULL,deadline_at=NULL,lease_expires_at=NULL WHERE id=$1 AND status IN('failed','timed_out','cancelled')",
            [r.id],
          );
        await c.query("COMMIT");
        return reply.code(202).send({ inputId: r.input_id, runId: r.id });
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
    },
  );
  async function readRun(id: string, ownerId: string) {
    const r = (
      await ctx.pool.query(
        "SELECT r.*,i.text,i.time_zone,(SELECT count(*)::int FROM model_request m WHERE m.run_id=r.id) request_count,(SELECT COALESCE(sum(reserved_usd),0)::float FROM model_request m WHERE m.run_id=r.id) reserved_usd,(SELECT COALESCE(sum(usage_usd) FILTER(WHERE settled),0)::float FROM model_request m WHERE m.run_id=r.id) usage_usd,(SELECT count(*) FILTER(WHERE NOT settled)::int FROM model_request m WHERE m.run_id=r.id) unknown_requests FROM agent_run r JOIN input_event i ON i.id=r.input_id WHERE r.id=$1 AND r.owner_id=$2",
        [id, ownerId],
      )
    ).rows[0];
    if (!r) throw new PublicError(404, "RUN_NOT_FOUND", "此处理记录不存在。");
    return {
      id: r.id,
      inputId: r.input_id,
      status: r.status,
      text: r.text,
      timeZone: r.time_zone,
      stillProcessing:
        r.status === "running" &&
        ctx.now().getTime() - new Date(r.started_at).getTime() >= 20000,
      cost:{reservedUsd:r.reserved_usd,usageUsd:r.usage_usd,unknownRequests:r.unknown_requests,invoiceAvailable:false as const},
      requests: Math.max(r.requests,r.request_count),
      toolCalls: r.tool_calls,
      ...(r.message ? { message: r.message } : {}),
      ...(r.task_id ? { taskId: r.task_id } : {}),
      ...(r.error_code ? { errorCode: r.error_code } : {}),
    };
  }
  app.post(
    "/v1/runs/:id/cancel",
    {
      schema: {
        security,
        headers: MutationHeaders,
        params: Type.Object({ id: Type.String({ format: "uuid" }) }),
        body: Type.Object({}, { additionalProperties: false }),
        response: { 200: RunDTO, ...errors },
      },
    },
    async (req) => {
      const identity = await ctx.session(req.headers.authorization),
        c = await ctx.pool.connect();
      try {
        await c.query("BEGIN");
        const r = (
          await c.query(
            "SELECT * FROM agent_run WHERE id=$1 AND owner_id=$2 FOR UPDATE",
            [req.params.id, identity.ownerId],
          )
        ).rows[0];
        if (!r)
          throw new PublicError(404, "RUN_NOT_FOUND", "此处理记录不存在。");
        const accepted = await c.query(
          "INSERT INTO agent_cancel(run_id,idempotency_key) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING run_id",
          [r.id, req.headers["idempotency-key"]],
        );
        if (accepted.rowCount)
          await c.query(
            "UPDATE agent_run SET status='cancelled',message='已停止继续处理。已保存的事项仍可查看；模型已产生的费用无法撤回。',finished_at=$2 WHERE id=$1 AND status IN('queued','running')",
            [r.id, ctx.now()],
          );
        await c.query("COMMIT");
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
      return readRun(req.params.id, identity.ownerId);
    },
  );
  app.get(
    "/v1/runs/:id",
    {
      schema: {
        security,
        params: Type.Object({ id: Type.String({ format: "uuid" }) }),
        response: { 200: RunDTO, ...errors },
      },
    },
    async (req) => {
      const i = await ctx.session(req.headers.authorization);
      return readRun(req.params.id, i.ownerId);
    },
  );
}
