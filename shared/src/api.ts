import { z } from "zod";

// Control-plane request bodies, shared verbatim with the client so forms and
// API can never drift. Money fields travel as strings — they are Decimals.

export const RoleSchema = z.enum(["OWNER", "ADMIN", "MEMBER", "VIEWER"]);
export type Role = z.infer<typeof RoleSchema>;

export const ProviderKindSchema = z.enum([
  "bedrock",
  "azure_openai",
  "anthropic",
  "openai",
  "vertex",
  "ollama",
  "mock",
]);
export type ProviderKind = z.infer<typeof ProviderKindSchema>;

export const MoneySchema = z
  .string()
  .regex(/^\d{1,8}(\.\d{1,4})?$/, "must be a decimal amount like 50 or 12.50");

export const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const CreateTeamBody = z.object({
  name: z.string().min(1).max(80),
  monthlyBudgetUsd: MoneySchema.nullable().optional(),
  allowedModels: z.array(z.string()).optional(),
});
export const UpdateTeamBody = CreateTeamBody.partial();

export const CreateUserBody = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(120),
  role: RoleSchema.default("MEMBER"),
  monthlyBudgetUsd: MoneySchema.nullable().optional(),
  teamIds: z.array(z.string()).optional(),
});
export const UpdateUserBody = z.object({
  name: z.string().min(1).max(120).optional(),
  role: RoleSchema.optional(),
  monthlyBudgetUsd: MoneySchema.nullable().optional(),
  status: z.enum(["active", "suspended"]).optional(),
  teamIds: z.array(z.string()).optional(),
});

export const CreateKeyBody = z.object({
  name: z.string().min(1).max(120),
  teamId: z.string().nullable().optional(),
  monthlyBudgetUsd: MoneySchema.nullable().optional(),
  allowedModels: z.array(z.string()).optional(),
  rpmLimit: z.number().int().positive().nullable().optional(),
  tpmLimit: z.number().int().positive().nullable().optional(),
  ipAllowlist: z.array(z.string()).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

export const ProviderConfigBody = z.object({
  provider: ProviderKindSchema,
  label: z.string().min(1).max(120),
  // Free-form JSON credential; the matching adapter zod-validates it on use
  // and the test endpoint proves it works before saving.
  config: z.record(z.unknown()),
});
export const TestProviderBody = ProviderConfigBody.pick({ provider: true, config: true }).extend({
  model: z.string().min(1),
});

export const RouteBody = z.object({
  providerId: z.string(),
  upstreamModel: z.string().min(1),
  priority: z.number().int().min(0),
  weight: z.number().int().min(1).max(1000).default(100),
  inputCostPer1M: MoneySchema,
  outputCostPer1M: MoneySchema,
  cachedInputCostPer1M: MoneySchema.nullable().optional(),
  defaultMaxTokens: z.number().int().positive().default(4096),
});

export const CreateAliasBody = z.object({
  alias: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9._-]*$/, "lowercase letters, digits, dot, dash, underscore"),
  displayName: z.string().min(1).max(120),
  description: z.string().max(500).nullable().optional(),
  enabled: z.boolean().default(true),
  routes: z.array(RouteBody).min(1),
});
export const UpdateAliasBody = CreateAliasBody.partial();

export const UpdateOrgBody = z.object({
  name: z.string().min(1).max(120).optional(),
  monthlyBudgetUsd: MoneySchema.nullable().optional(),
  settings: z
    .object({
      adminCanViewPrompts: z.boolean().optional(),
      storeRawPrompts: z.boolean().optional(),
      logRetentionDays: z.number().int().min(1).max(3650).optional(),
    })
    .optional(),
});

export const CreateBudgetRequestBody = z.object({
  requestedUsd: MoneySchema,
  reason: z.string().max(1000).optional(),
});
export const DecideBudgetRequestBody = z.object({
  decision: z.enum(["approved", "denied"]),
  reason: z.string().max(1000).optional(),
});

export const LogQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  userId: z.string().optional(),
  teamId: z.string().optional(),
  model: z.string().optional(),
  status: z.coerce.number().int().optional(),
  minCost: z.coerce.number().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(), // "<createdAtIso>|<id>"
});
