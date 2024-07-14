import { Type, } from "@sinclair/typebox";
import type { Static, } from "@sinclair/typebox";
export enum Role {
  USER,
  ADMIN,
}

export const Post = Type.Object({
  Id: Type.Number(),
  CreatedAt: Type.String({ minLength: 1, },),
  UpdatedAt: Type.String({ minLength: 1, },),
  Published: Type.Boolean(),
  AuthorId: Type.Optional(Type.Number(),),
  Title: Type.String({ minLength: 1, },),
},);

export type PostType = Static<typeof Post>;

export const User = Type.Object({
  Id: Type.Number(),
  CreatedAt: Type.String({ minLength: 1, },),
  Role: Type.Enum(Role,),
  Email: Type.String({ minLength: 1, },),
  Name: Type.Optional(Type.String(),),
},);

export type UserType = Static<typeof User>;
