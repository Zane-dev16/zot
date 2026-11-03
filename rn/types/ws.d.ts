// Minimal ambient types for the `ws` devDependency. Only the server surface the
// stream test drives is declared; ws ships no types of its own at this version.

declare module "ws" {
	export type WsSocket = {
		send(data: string): void;
		close(): void;
		on(event: "close" | "error", listener: () => void): void;
	};

	export type WsRequest = {
		url?: string;
	};

	export class Server {
		constructor(options: { port: number; host?: string }, listener?: () => void);
		address(): { port: number } | null;
		close(callback?: () => void): void;
		on(
			event: "connection",
			listener: (socket: WsSocket, request: WsRequest) => void,
		): void;
	}
}
