import { ConnectorUnavailable, connectorRuntime, connectorVersion, installConnector, verifyConnector } from '../gateway/account-connector.ts';
import { defaultDataDir } from '../workspace.ts';

try {
  await verifyConnector(import.meta.url).catch(() => installConnector(connectorRuntime(defaultDataDir)));
  console.log('OpenDesign sign-in component ready (' + connectorVersion + ').');
} catch (error) {
  console.error('OpenDesign sign-in preparation failed. Sign-in will retry automatically.', error instanceof ConnectorUnavailable ? error.advice || error.message : String(error));
  process.exitCode = 1;
}
