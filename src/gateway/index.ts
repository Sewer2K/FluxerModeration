import { applyShardPatches } from './shardPatches';
import { initGateway, type GatewayConfig } from './gatewayManager';

export { applyShardPatches } from './shardPatches';
export { initGateway, type GatewayConfig } from './gatewayManager';

export function setupGateway(config: GatewayConfig): void {
  applyShardPatches();
  initGateway(config);
}
