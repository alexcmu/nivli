import { Type } from "@sinclair/typebox";
const uuid = Type.String({ format: "uuid" }),
  instant = Type.String({ format: "date-time" }),
  zone = Type.String({ minLength: 1, maxLength: 100 });
const object = { additionalProperties: false };
export const DeadlineDTO = Type.Union([
  Type.Object(
    {
      kind: Type.Literal("date"),
      date: Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
      timeZone: zone,
    },
    object,
  ),
  Type.Object(
    { kind: Type.Literal("instant"), instant, timeZone: zone },
    object,
  ),
]);
export const OccurrenceDTO = Type.Object(
  {
    id: uuid,
    reminderRevision: Type.Integer({ minimum: 1 }),
    routingVersion: Type.Integer({ minimum: 1 }),
    requestId: Type.String(),
    scheduledAt: instant,
    timeZone: zone,
    installationStatus: Type.Union([
      Type.Literal("pending"),
      Type.Literal("installed"),
      Type.Literal("denied"),
      Type.Literal("capacity"),
      Type.Literal("failed"),
    ]),
    quietHoursConfirmed: Type.Boolean(),
  },
  object,
);
export const NotificationPlansDTO = Type.Object({
  plans: Type.Array(
    Type.Object({ ...OccurrenceDTO.properties, taskId: uuid }, object),
  ),
});
export const NotificationPlanCommandDTO = Type.Object(
  {
    operation: Type.Union([
      Type.Literal("claim"),
      Type.Literal("installed"),
      Type.Literal("failed"),
      Type.Literal("confirm-quiet-hours"),
    ]),
    occurrenceId: uuid,
    reminderRevision: Type.Integer({ minimum: 1 }),
    routingVersion: Type.Integer({ minimum: 1 }),
    requestId: Type.Optional(Type.String({ maxLength: 200 })),
    result: Type.Optional(
      Type.Union([
        Type.Literal("denied"),
        Type.Literal("capacity"),
        Type.Literal("failed"),
      ]),
    ),
  },
  object,
);
export const CreateTaskDTO = Type.Object(
  {
    taskId: uuid,
    localDeviceId: Type.Optional(uuid),
    quietHoursConfirmed: Type.Optional(Type.Boolean()),
    commandId: uuid,
    title: Type.String({ minLength: 1, maxLength: 300 }),
    background: Type.Optional(Type.String({ maxLength: 2000 })),
    reminder: Type.Optional(Type.Object({ instant, timeZone: zone }, object)),
    deadline: Type.Optional(DeadlineDTO),
  },
  object,
);
export const TaskDTO = Type.Object(
  {
    id: uuid,
    ownerId: uuid,
    revision: Type.Integer({ minimum: 1 }),
    status: Type.Union([
      Type.Literal("active"),
      Type.Literal("completed"),
      Type.Literal("cancelled"),
    ]),
    title: Type.String(),
    background: Type.String(),
    deadline: Type.Union([DeadlineDTO, Type.Null()]),
    reminder: Type.Union([
      Type.Object(
        {
          id: uuid,
          revision: Type.Integer({ minimum: 1 }),
          instant,
          timeZone: zone,
          schedulingStatus: Type.Union([
            Type.Literal("not_scheduled"),
            Type.Literal("needs_confirmation"),
            Type.Literal("local_pending"),
            Type.Literal("local_installed"),
            Type.Literal("permission_denied"),
            Type.Literal("capacity_exceeded"),
            Type.Literal("installation_failed"),
          ]),
          occurrence: Type.Optional(OccurrenceDTO),
        },
        object,
      ),
      Type.Null(),
    ]),
    sources: Type.Array(
      Type.Object(
        {
          id: uuid,
          kind: Type.Union([
            Type.Literal("manual"),
            Type.Literal("instruction"),
          ]),
          text: Type.String(),
          createdAt: instant,
        },
        object,
      ),
    ),
    createdAt: instant,
    updatedAt: instant,
  },
  object,
);
export const TaskPageDTO = Type.Object(
  {
    tasks: Type.Array(TaskDTO),
    nextCursor: Type.Union([Type.String(), Type.Null()]),
  },
  object,
);
