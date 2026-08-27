export function shouldPublishSalesSnapshot(fromCache: boolean, cloudOnline: boolean): boolean {
  return !fromCache || !cloudOnline;
}
