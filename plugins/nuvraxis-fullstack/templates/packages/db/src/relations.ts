import { defineRelations } from "drizzle-orm";
import * as schema from "./schema";

// All relations in one place (Drizzle relations v2). Add them as tables gain foreign keys:
//   users: { posts: r.many.posts() },
//   posts: { author: r.one.users({ from: r.posts.authorId, to: r.users.id }) },
export const relations = defineRelations(schema, () => ({}));
