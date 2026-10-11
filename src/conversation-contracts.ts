import { Type } from "@sinclair/typebox";
import { TaskDTO } from "./task-contracts.js";
const uuid = Type.String({ format: "uuid" });
export const ConversationDTO = Type.Object(
  {
    id: uuid,
    revision: Type.Integer(),
    acceptedRevision: Type.Integer(),
    messages: Type.Array(
      Type.Object(
        {
          inputId: uuid,
          runId: uuid,
          revision: Type.Integer(),
          text: Type.String(),
          timeZone: Type.String(),
          status: Type.String(),
          message: Type.Optional(Type.String()),
          errorCode: Type.Optional(Type.String()),
          replyToInputId: Type.Optional(uuid),
          task: Type.Optional(TaskDTO),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
