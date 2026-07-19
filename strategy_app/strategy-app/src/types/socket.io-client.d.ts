// socket.io-client v2 は型定義を同梱しない（旧来 @types/socket.io-client 別配布）。
// このアプリではサーバー側 timing-feed.ts でのみ使うため、any 扱いで宣言する。
declare module 'socket.io-client';
