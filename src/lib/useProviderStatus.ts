import { useEffect, useState } from 'react';
import { connectRoom, provider } from './room';

export type ProviderStatus = 'connecting' | 'live' | 'offline';

function getInitialStatus(): ProviderStatus {
  if (provider.synced) return 'live';
  if (provider.wsconnected || provider.wsconnecting) return 'connecting';
  return 'offline';
}

export function useProviderStatus(): ProviderStatus {
  const [status, setStatus] = useState<ProviderStatus>(getInitialStatus);

  useEffect(() => {
    connectRoom();

    function onStatus({ status: s }: { status: string }) {
      if (s === 'disconnected') setStatus('offline');
      else setStatus('connecting'); // 'connecting' or 'connected' — not yet synced
    }

    function onSync(synced: boolean) {
      setStatus(synced ? 'live' : (provider.wsconnected ? 'connecting' : 'offline'));
    }

    provider.on('status', onStatus);
    provider.on('sync', onSync);

    return () => {
      provider.off('status', onStatus);
      provider.off('sync', onSync);
    };
  }, []);

  return status;
}
