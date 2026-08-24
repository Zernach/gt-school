export type StartableContainer = {
  startAndWaitForPorts(options?: {
    cancellationOptions?: { instanceGetTimeoutMS?: number; portReadyTimeoutMS?: number };
  }): Promise<void>;
  fetch(request: Request): Promise<Response>;
  stop(signal?: 'SIGTERM'): Promise<void>;
};

const portUnavailable = /container is not listening in the TCP address/i;
const startupTimeoutMS = 45_000;

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return 'unknown';
}

/**
 * Retry only the pre-forwarding port race. Retrying a failed fetch could replay
 * a mutation, while waiting for a port has not sent the request to the API.
 */
export async function forwardToReadyContainer(container: StartableContainer, request: Request): Promise<Response> {
  try {
    await container.startAndWaitForPorts({ cancellationOptions: { instanceGetTimeoutMS: startupTimeoutMS, portReadyTimeoutMS: startupTimeoutMS } });
  } catch (error) {
    const message = errorMessage(error);
    if (!portUnavailable.test(message)) throw error;
    console.warn(JSON.stringify({ event: 'container.port_unavailable', attempt: 1, action: 'restart', message }));
    await container.stop('SIGTERM');
    await container.startAndWaitForPorts({ cancellationOptions: { instanceGetTimeoutMS: startupTimeoutMS, portReadyTimeoutMS: startupTimeoutMS } });
  }
  return container.fetch(request);
}
