import { Type } from "@sinclair/typebox";
const uuid = Type.String({ format: "uuid" });
export const PushRegistrationDTO = Type.Object(
  {
    token: Type.String({ pattern: "^(?:[a-fA-F0-9]{2}){16,256}$" }),
    topic: Type.String({ minLength: 3, maxLength: 200 }),
    environment: Type.Union([
      Type.Literal("development"),
      Type.Literal("production"),
    ]),
    enabled: Type.Boolean(),
    authorized: Type.Boolean(),
  },
  { additionalProperties: false },
);
export const PushStatusDTO = Type.Object({
  configured: Type.Boolean(),
  topic: Type.Union([Type.String(), Type.Null()]),
  environment: Type.Union([Type.String(), Type.Null()]),
  registered: Type.Boolean(),
  enabled: Type.Boolean(),
  authorized: Type.Boolean(),
  invalidated: Type.Boolean(),
});
export const RemoteOccurrenceDTO = Type.Object({
  id: uuid,
  reminderRevision: Type.Integer(),
  routingVersion: Type.Integer(),
  deliveryOwner: Type.Literal("server"),
  status: Type.Union([
    Type.Literal("planned"),
    Type.Literal("sending"),
    Type.Literal("accepted"),
    Type.Literal("unknown"),
    Type.Literal("failed"),
    Type.Literal("expired"),
    Type.Literal("cancelled"),
  ]),
  quietHoursConfirmed: Type.Boolean(),
  scheduledAt: Type.String({ format: "date-time" }),
  expiresAt: Type.String({ format: "date-time" }),
  attempt: Type.Integer(),
  lastError: Type.Union([Type.String(), Type.Null()]),
});
