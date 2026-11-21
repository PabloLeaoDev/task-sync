const REQUIRED_VARIABLES = [
  'DATABASE_URL',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
] as const;

/**
 * Validates the environment on startup so the application never runs with
 * missing secrets or an unconfigured database.
 */
export function validateEnv(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const missing = REQUIRED_VARIABLES.filter((key) => {
    const value = config[key];
    return typeof value !== 'string' || value.trim().length === 0;
  });

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(', ')}`,
    );
  }

  const port = Number(config.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be a valid TCP port');
  }

  const bcryptRounds = Number(config.BCRYPT_SALT_ROUNDS ?? 12);
  if (!Number.isInteger(bcryptRounds) || bcryptRounds < 4 || bcryptRounds > 15) {
    throw new Error('BCRYPT_SALT_ROUNDS must be an integer between 4 and 15');
  }

  return {
    ...config,
    PORT: port,
    BCRYPT_SALT_ROUNDS: bcryptRounds,
  };
}
