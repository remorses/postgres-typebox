import { Type, } from "@sinclair/typebox";
import type { Static, } from "@sinclair/typebox";
export enum Role {
  USER,
  ADMIN,
}

export const Post = Type.Object({
  id: Type.Number(),
  createdAt: Type.String({ minLength: 1, },),
  updatedAt: Type.String({ minLength: 1, },),
  published: Type.Boolean(),
  authorId: Type.Optional(Type.Number(),),
  title: Type.String({ minLength: 1, },),
},);

export type postType = Static<typeof Post>;

export const User = Type.Object({
  id: Type.Number(),
  createdAt: Type.String({ minLength: 1, },),
  role: Type.Enum(Role,),
  email: Type.String({ minLength: 1, },),
  name: Type.Optional(Type.String(),),
},);

export type userType = Static<typeof User>;
