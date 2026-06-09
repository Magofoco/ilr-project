/**
 * Promote a Supabase user to the `admin` role.
 *
 * Usage:
 *   pnpm --filter @ilr/api run promote-admin you@example.com
 *
 * Looks the user up in Supabase via the Auth admin API (so it works whether
 * `DATABASE_URL` points at the local Docker DB or at the Supabase DB), then
 * upserts a row in our own `user_roles` table.
 *
 * Requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to be set. The dev
 * script loads `.env` from the repo root via `--env-file`; if you run this
 * file directly with `tsx`, export those vars in your shell first.
 */

import { prisma } from '@ilr/db';

interface SupabaseAdminUser {
  id: string;
  email: string | null;
}

interface SupabaseAdminUsersResponse {
  users: SupabaseAdminUser[];
}

async function lookupUserByEmail(email: string): Promise<SupabaseAdminUser> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set. ' +
        'Source the repo .env file or run via `pnpm --filter @ilr/api run promote-admin`.',
    );
  }

  // The Supabase admin REST endpoint supports `?email=` as a server-side filter.
  // Documented: https://supabase.com/docs/reference/api/admin-list-users
  const url = new URL(`${supabaseUrl}/auth/v1/admin/users`);
  url.searchParams.set('email', email);

  const response = await fetch(url, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `Supabase admin API responded ${response.status}: ${body || response.statusText}`,
    );
  }

  const body = (await response.json()) as SupabaseAdminUsersResponse | SupabaseAdminUser[];

  // Defensive: the endpoint has historically returned either { users: [...] }
  // or a bare array depending on version. Handle both.
  const users = Array.isArray(body) ? body : body.users;

  const match = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());

  if (!match) {
    throw new Error(
      `No Supabase user found with email "${email}". ` +
        'Sign them up first via the /signup page or Supabase Studio.',
    );
  }

  return match;
}

async function main() {
  const email = process.argv[2];

  if (!email || !email.includes('@')) {
    console.error(
      'Usage: pnpm --filter @ilr/api run promote-admin <email>\n' +
        'Example: pnpm --filter @ilr/api run promote-admin you@example.com',
    );
    process.exit(1);
  }

  console.log(`Looking up ${email} in Supabase Auth...`);
  const user = await lookupUserByEmail(email);
  console.log(`Found user: id=${user.id}`);

  const role = await prisma.userRole.upsert({
    where: { userId: user.id },
    update: { role: 'admin' },
    create: { userId: user.id, role: 'admin' },
  });

  console.log(
    `\n\u2713 ${email} is now '${role.role}' in user_roles ` +
      `(row id=${role.id}).\nReload the app and the Admin link will appear.`,
  );
}

main()
  .catch(async (err: unknown) => {
    console.error('\n\u2717 promote-admin failed:');
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
