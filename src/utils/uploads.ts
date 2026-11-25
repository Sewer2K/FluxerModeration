import path from 'path';

/**
 * Directory that stores user-uploaded dashboard assets (welcome backgrounds).
 * Defaults to the dashboard build output, but deployments should point
 * UPLOADS_DIR at a persistent volume so uploads survive rebuilds.
 */
export function uploadsRoot(): string {
  return process.env.UPLOADS_DIR || path.join(__dirname, '..', '..', 'dashboard', 'dist', 'uploads');
}
