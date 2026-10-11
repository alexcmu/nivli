import { Type } from "@sinclair/typebox";
const object = { additionalProperties: false },
  uuid = Type.String({ format: "uuid" });
export const InputDTO = Type.Object(
  {
    text: Type.String({ minLength: 1, maxLength: 2000 }),
    timeZone: Type.String({ minLength: 1, maxLength: 100 }),
  },
  object,
);
export const QueuedDTO = Type.Object({ inputId: uuid, runId: uuid }, object);
export const RunDTO = Type.Object(
  {
    id: uuid,
    inputId: uuid,
    status: Type.Union([
      Type.Literal("queued"),
      Type.Literal("running"),
      Type.Literal("succeeded"),
      Type.Literal("clarification"),
      Type.Literal("failed"),
    ]),
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
