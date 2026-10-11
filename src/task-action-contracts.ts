import { Type } from "@sinclair/typebox";
import { DeadlineDTO } from "./task-contracts.js";
const uuid = Type.String({ format: "uuid" });
export const TaskActionDTO = Type.Object(
  {
    commandId: uuid,
    clientMutationId: uuid,
    expectedRevision: Type.Integer({ minimum: 1 }),
    operation: Type.Union(
      ["edit", "complete", "cancel", "snooze", "restore", "undo"].map((v) =>
        Type.Literal(v),
      ),
    ),
    title: Type.Optional(Type.String({ minLength: 1, maxLength: 300 })),
    background: Type.Optional(Type.String({ maxLength: 2000 })),
    deadline: Type.Optional(Type.Union([DeadlineDTO, Type.Null()])),
    reminder: Type.Optional(
      Type.Union([
        Type.Object(
          {
            instant: Type.String({ format: "date-time" }),
            timeZone: Type.String({ minLength: 1, maxLength: 100 }),
          },
          { additionalProperties: false },
        ),
        Type.Null(),
      ]),
    ),
    quietHoursConfirmed: Type.Optional(Type.Boolean()),
    targetMutationId: Type.Optional(uuid),
    occurrence: Type.Optional(
      Type.Object(
        {
          id: uuid,
          reminderRevision: Type.Integer({ minimum: 1 }),
          routingVersion: Type.Integer({ minimum: 1 }),
          requestId: Type.String(),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
