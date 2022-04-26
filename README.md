# TON-X

Connector for dApps for TON blockchain

Supported connectors:
* [Tonhub](https://tonhub.com) and [Tondev](https://test.tonhub.com)

## Tonhub connector

Connecting app to a wallet:
1) Create session
2) Show user QR Code or link
3) Await session confirmation

### Create connector

```typescript
import { TonhubConnector } from 'ton-x';
const connector = new TonhubConnector({ testnet: true });
```

### Creating session

```typescript
let session = await connector.createNewSession({
    name: 'Your app name',
    url: 'Your app url'
});

// Session ID, Seed and Auth Link
const sessionId = session.id;
const sessionSeed = session.seed;
const sessionLink = session.link;
```

### Await session confirmation

```typescript
const session = await connector.awaitSessionReady(sessionId, 5 * 60 * 1000); // 5 min timeout

if (session.state === 'revoked' || session.state === 'expired') {
    // Handle revoked or expired session
} else if (session.state === 'ready') {
    
    // Handle session
    const walletConfig: TonhubWalletConfig = session.walletConfig;
    
    // You need to persist this values to work with this connection:
    // * sessionId
    // * sessionSeed
    // * walletConfig

    // You can check signed wallet config on backend using TonhubConnector.verifyWalletConfig.
    // walletConfig is cryptographically signed for specific session and other parameters
    // you can safely use it as authentication proof without the need to sign something.
    const correctConfig: boolean = TonhubConnector.verifyWalletConfig(sessionId, walletConfig);

    // ...

} else {
    throw new Error('Impossible');
}
```

# License 
MIT