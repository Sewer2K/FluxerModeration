import { AlertTriangle } from 'lucide-react';
import type { PublicStatus } from '../lib/api';

export function BotStatusBanner({ status }: { status: PublicStatus | null }) {
  if (!status || status.online) return null;

  return (
    <div data-bot-status-banner className="px-6 lg:px-8 pt-3 lg:pt-4 mb-6">
      <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
        <div className="min-w-0">
          <p className="font-medium text-amber-50">Bot is offline</p>
          <p className="mt-0.5 text-xs text-amber-100/80">
            The dashboard is up, but ClaudeCityMod is not connected to Fluxer right now. You can still view and save settings;
            live actions like posting panels, tickets, and tests will fail until the bot is back.
          </p>
        </div>
      </div>
    </div>
  );
}
