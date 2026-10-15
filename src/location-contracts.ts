import { Type } from "@sinclair/typebox";
import { RemoteOccurrenceDTO } from "./push-contracts.js";
const uuid = Type.String({ format: "uuid" }),
  object = { additionalProperties: false };
export const PlaceFields = {
  name: Type.String({ minLength: 1, maxLength: 80 }),
  latitude: Type.Number({ minimum: -90, maximum: 90 }),
  longitude: Type.Number({ minimum: -180, maximum: 180 }),
  radius: Type.Number({ minimum: 100, maximum: 1000 }),
};
export const PlaceDTO = Type.Object(
  { id: uuid, revision: Type.Integer({ minimum: 1 }), ...PlaceFields },
  object,
);
export const LocationInputDTO = Type.Object(
  {
    placeId: uuid,
    placeRevision: Type.Integer({ minimum: 1 }),
    transition: Type.Union([Type.Literal("enter"), Type.Literal("exit")]),
    timeZone: Type.String({ minLength: 1, maxLength: 100 }),
    quietHoursConfirmed: Type.Optional(Type.Boolean()),
  },
  object,
);
export const LocationPlanDTO = Type.Object(
  {
    id: uuid,
    reminderRevision: Type.Integer(),
    taskId: uuid,
    place: PlaceDTO,
    transition: Type.Union([Type.Literal("enter"), Type.Literal("exit")]),
    timeZone: Type.String(),
    installationStatus: Type.String(),
    quietHoursConfirmed: Type.Boolean(),
    triggeredAt: Type.Union([
      Type.String({ format: "date-time" }),
      Type.Null(),
    ]),
    remoteOccurrence: Type.Optional(RemoteOccurrenceDTO),
  },
  object,
);
