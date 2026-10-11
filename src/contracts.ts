import { Type } from "@sinclair/typebox";
export const ErrorDTO = Type.Object(
  {
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    retryable: Type.Boolean(),
  },
  { additionalProperties: false },
);
export const EnvironmentDTO = Type.Object(
  {
    name: Type.String(),
    host: Type.String(),
    pushMode: Type.Union([
      Type.Literal("self_signed"),
      Type.Literal("disabled"),
      Type.Literal("relay"),
    ]),
    modelDataDestination: Type.String(),
    capabilities: Type.Array(Type.String()),
  },
  { additionalProperties: false },
);
export const SessionDTO = Type.Object(
  {
    ownerId: Type.String({ format: "uuid" }),
    deviceId: Type.String({ format: "uuid" }),
    sessionId: Type.String({ format: "uuid" }),
  },
  { additionalProperties: false },
);
export const CredentialsDTO = Type.Object(
  {
    ...SessionDTO.properties,
    accessToken: Type.String(),
    refreshToken: Type.String(),
    accessExpiresAt: Type.String({ format: "date-time" }),
    refreshExpiresAt: Type.String({ format: "date-time" }),
    capabilities: Type.Array(Type.String()),
    sync: Type.Object({ state: Type.Literal("not_available") }),
  },
  { additionalProperties: false },
);
export const ClaimDTO = Type.Object(
  {
    code: Type.String({ minLength: 1, maxLength: 100 }),
    deviceName: Type.String({ minLength: 1, maxLength: 100 }),
  },
  { additionalProperties: false },
);
export const RenewDTO = Type.Object(
  { refreshToken: Type.String({ minLength: 1, maxLength: 200 }) },
  { additionalProperties: false },
);
export const MutationHeaders = Type.Object(
  { "idempotency-key": Type.String({ format: "uuid" }) },
  { additionalProperties: true },
);
