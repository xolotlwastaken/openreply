export function zernioIntegrationEnabled(): boolean {
  return process.env.ZERNIO_INTEGRATION_ENABLED === "true";
}
