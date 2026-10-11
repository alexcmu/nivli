import { Type } from "@sinclair/typebox";
const object = { additionalProperties: false },
  uuid = Type.String({ format: "uuid" });
export const InputDTO = Type.Object(
  {
    conversationId: Type.Optional(uuid),
    replyToInputId: Type.Optional(uuid),
    taskId: Type.Optional(uuid),
    text: Type.String({ minLength: 1, maxLength: 2000 }),
    timeZone: Type.String({ minLength: 1, maxLength: 100 }),
  },
  object,
);
export const QueuedDTO = Type.Object(
  {
    inputId: uuid,
    runId: uuid,
    conversationId: Type.Optional(uuid),
    conversationRevision: Type.Optional(Type.Integer()),
  },
  object,
);
export const RunDTO = Type.Object(
  {
    id: uuid,
    inputId: uuid,
    status: Type.Union([
      Type.Literal("queued"),
      Type.Literal("running"),
      Type.Literal("succeeded"),
      Type.Literal("needs_clarification"),
      Type.Literal("cancelled"),
      Type.Literal("timed_out"),
      Type.Literal("failed"),
    ]),
    text: Type.String(),
    timeZone: Type.String(),
    stillProcessing: Type.Boolean(),
    errorCode: Type.Optional(Type.String()),
    cost:Type.Object({reservedUsd:Type.Number(),usageUsd:Type.Number(),unknownRequests:Type.Integer(),invoiceAvailable:Type.Literal(false)},{additionalProperties:false}),
    requests: Type.Integer(),
    toolCalls: Type.Integer(),
    message: Type.Optional(Type.String()),
    taskId: Type.Optional(uuid),
  },
  object,
);
export const ModelDTO = Type.Object(
  {
    configured: Type.Boolean(),
    provider: Type.String(),
    model: Type.String(),
    dataDestination: Type.String(),
  },
  object,
);
