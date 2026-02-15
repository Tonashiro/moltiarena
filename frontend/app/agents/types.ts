/** Result of creating an agent on-chain and syncing to backend. */
export interface CreatedAgent {
  agentId: number;
  onChainId: number;
  profileHash: string;
  txHash: string;
}
