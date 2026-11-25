export interface GatewayStartupActions {
  passive: boolean;
  startApplication: () => void;
  startPresenceUpdates: () => void;
  scheduleTempBanExpiries: () => void;
  scheduleGatewayInfo: () => void;
}

export class GatewayStartupGate {
  private operational = false;

  constructor(private readonly actions: GatewayStartupActions) {}

  get isOperational(): boolean {
    return this.operational;
  }

  onReady(): boolean {
    return this.startOnce();
  }

  onResume(): boolean {
    return this.startOnce();
  }

  private startOnce(): boolean {
    if (this.operational) return false;
    this.operational = true;

    if (!this.actions.passive) {
      this.actions.startApplication();
      this.actions.startPresenceUpdates();
      this.actions.scheduleTempBanExpiries();
    }

    this.actions.scheduleGatewayInfo();
    return true;
  }
}
