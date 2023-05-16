import { getSecureRandomBytes, keyPairFromSeed } from "ton-crypto";
import { backoff, delay } from "../utils/time";
import { toUrlSafe } from "../utils/toURLsafe";
import { Cell, Address, beginCell, comment, safeSign, safeSignVerify } from 'ton-core';
import { TonhubHttpTransport } from '../transport/TonhubHttpTransport';
import { extractPublicKeyAndAddress } from "../contracts/extractPublicKeyAndAddress";
import { verifySignatureResponse } from "./crypto";
import { Transport } from '../transport/Transport';

type SessionState = {
    state: 'not_found'
} |
{
    state: 'initing',
    name: string,
    url: string,
    testnet: boolean,
    created: number,
    updated: number,
    revoked: boolean
} | {
    state: 'ready',
    name: string,
    url: string,
    wallet: {
        address: string,
        endpoint: string,
        walletConfig: string,
        walletType: string,
        walletSig: string,
        appPublicKey: string
    },
    testnet: boolean,
    created: number,
    updated: number,
    revoked: boolean
}

type JobState = {
    state: 'submitted' | 'expired' | 'rejected',
    job: string,
    created: number,
    updated: number,
    now: number
} | {
    state: 'completed',
    job: string,
    created: number,
    updated: number,
    result: string,
    now: number
} | {
    state: 'empty',
    now: number
}

export type TonhubWalletConfig = {
    address: string,
    endpoint: string,
    walletType: string,
    walletConfig: string,
    walletSig: string,
    appPublicKey: string
}

export type TonhubCreatedSession = {
    id: string
    seed: string,
    link: string
};

export type TonhubSessionStateRevoked = {
    state: 'revoked'
};

export type TonhubSessionStateExpired = {
    state: 'expired'
}

export type TonhubSessionStateReady = {
    state: 'ready',
    name: string,
    url: string,
    created: number,
    updated: number,
    wallet: TonhubWalletConfig
}

export type TonhubSessionStateIniting = {
    state: 'initing',
    name: string,
    url: string,
    created: number,
    updated: number
}

export type TonhubSessionState = TonhubSessionStateIniting | TonhubSessionStateRevoked | TonhubSessionStateReady;
export type TonhubSessionAwaited = TonhubSessionStateRevoked | TonhubSessionStateReady | TonhubSessionStateExpired;

export type TonhubTransactionRequest = {
    seed: string,
    appPublicKey: string,
    to: string,
    value: string,
    timeout: number,
    stateInit?: string | null | undefined,
    text?: string | null | undefined,
    payload?: string | null | undefined
};

export type TonhubTransactionResponse = {
    type: 'success',
    response: string
} | {
    type: 'rejected'
} | {
    type: 'expired'
} | {
    type: 'invalid_session'
};

export type TonhubSignRequest = {
    seed: string,
    appPublicKey: string,
    timeout: number,
    text?: string | null | undefined,
    payload?: string | null | undefined
}

export type TonhubSignResponse = {
    type: 'success',
    signature: string
} | {
    type: 'rejected'
} | {
    type: 'expired'
} | {
    type: 'invalid_session'
};

function idFromSeed(seed: string) {
    let keyPair = keyPairFromSeed(Buffer.from(seed, 'base64'));
    return toUrlSafe(keyPair.publicKey.toString('base64'));
}

export class TonhubConnector {

    static verifyWalletConfig(session: string, config: TonhubWalletConfig) {

        // Check address
        const address = Address.parseFriendly(config.address).address;

        // Extract public key and address
        let extracted = extractPublicKeyAndAddress(config);
        if (!extracted) {
            return false;
        }

        // Check address
        if (!extracted.address.equals(address)) {
            return false;
        }

        let publicKey: Buffer = extracted.publicKey;

        // Check signature
        let toSign = beginCell()
            .storeCoins(0)
            .storeBuffer(Buffer.from(session, 'base64'))
            .storeAddress(address)
            // Endpoint
            .storeBit(1)
            .storeRef(beginCell()
                .storeBuffer(Buffer.from(config.endpoint))
                .endCell())
            // App Public Key
            .storeRef(beginCell()
                .storeBuffer(Buffer.from(config.appPublicKey, 'base64'))
                .endCell())
            .endCell();

        // Sign
        return safeSignVerify(toSign, Buffer.from(config.walletSig, 'base64'), publicKey);
    }

    readonly network: 'mainnet' | 'testnet';
    readonly transport: Transport;


    constructor(args?: { network?: 'mainnet' | 'testnet', transport?: Transport }) {
        let network: 'mainnet' | 'testnet' = 'mainnet';
        if (args) {
            if (args.network !== undefined) {
                network = args.network;
            }
        }

        this.network = network;
        this.transport = args?.transport || new TonhubHttpTransport();
    }

    createNewSession = async (args: { name: string, url: string }): Promise<TonhubCreatedSession> => {

        // Generate new key
        let seed = await getSecureRandomBytes(32);
        let keyPair = keyPairFromSeed(seed);
        let sessionId = toUrlSafe(keyPair.publicKey.toString('base64'));

        // Request new session
        await backoff(async () => {
            let session = await this.transport.call('session_new', {
                key: sessionId,
                testnet: this.network === 'testnet',
                name: args.name,
                url: args.url,
            });


            if (!session.ok) {
                throw Error('Unable to create state');
            }
        });

        // Return session
        return {
            id: sessionId,
            seed: seed.toString('base64'),
            link: (this.network === 'testnet' ? 'ton-test://connect/' : 'ton://connect/') + sessionId + '?endpoint=connect.tonhubapi.com'
        };
    }

    private ensureSessionStateCorrect = (sessionId: string, ex: SessionState): TonhubSessionState => {
        if (ex.state === 'initing') {
            if (ex.testnet !== (this.network === 'testnet')) {
                return { state: 'revoked' };
            }
            return {
                state: 'initing',
                name: ex.name,
                url: ex.url,
                created: ex.created,
                updated: ex.updated
            };
        }
        if (ex.state === 'ready') {
            if (ex.revoked) {
                return { state: 'revoked' };
            }
            if (ex.testnet !== (this.network === 'testnet')) {
                return { state: 'revoked' };
            }
            if (!TonhubConnector.verifyWalletConfig(sessionId, ex.wallet)) {
                throw Error('Integrity check failed');
            }

            return {
                state: 'ready',
                name: ex.name,
                url: ex.url,
                created: ex.created,
                updated: ex.updated,
                wallet: {
                    address: ex.wallet.address,
                    endpoint: ex.wallet.endpoint,
                    walletType: ex.wallet.walletType,
                    walletConfig: ex.wallet.walletConfig,
                    walletSig: ex.wallet.walletSig,
                    appPublicKey: ex.wallet.appPublicKey
                }
            };
        }

        return { state: 'revoked' };
    }

    getSessionState = async (sessionId: string): Promise<TonhubSessionState> => {
        return await backoff(async () => {
            let session = await this.transport.call('session_get', {
                id: sessionId
            });
            return this.ensureSessionStateCorrect(sessionId, session);
        });
    }

    waitForSessionState = async (sessionId: string, lastUpdated?: number): Promise<TonhubSessionState> => {
        return await backoff(async () => {
            let session = await this.transport.call('session_wait', {
                id: sessionId,
                lastUpdated
            });
            return this.ensureSessionStateCorrect(sessionId, session);
        })
    }

    awaitSessionReady = async (sessionId: string, timeout: number, lastUpdated?: number): Promise<TonhubSessionAwaited> => {
        let expires = Date.now() + timeout;
        let res: TonhubSessionStateReady | TonhubSessionStateExpired | TonhubSessionStateRevoked = await backoff(async () => {
            while (Date.now() < expires) {
                let existing = await this.waitForSessionState(sessionId, lastUpdated);
                if (existing.state !== 'initing') {
                    if (existing.state === 'ready') {
                        return existing;
                    } else if (existing.state === 'revoked') {
                        return existing;
                    }
                }
                await delay(1000);
            }
            return { state: 'expired' };
        });
        return res;
    }

    requestTransaction = async (request: TonhubTransactionRequest): Promise<TonhubTransactionResponse> => {
        const sessionId = idFromSeed(request.seed);

        // Check session
        let session = await backoff(() => this.getSessionState(sessionId));
        if (session.state !== 'ready') {
            return { type: 'invalid_session' };
        }
        if (session.wallet.appPublicKey !== request.appPublicKey) {
            return { type: 'invalid_session' };
        }

        // Parse address
        let address = Address.parseFriendly(request.to).address;

        // Value
        let value = BigInt(request.value);

        // Parse data
        let data: Cell | null = null;
        if (typeof request.payload === 'string') {
            data = Cell.fromBoc(Buffer.from(request.payload, 'base64'))[0];
        }

        // StateInit
        let stateInit: Cell | null = null;
        if (typeof request.stateInit === 'string') {
            stateInit = Cell.fromBoc(Buffer.from(request.stateInit, 'base64'))[0];
        }

        // Comment
        let commentMsg: string = '';
        if (typeof request.text === 'string') {
            commentMsg = request.text;
        }

        // Prepare cell
        let expires = Math.floor((Date.now() + request.timeout) / 1000);
        const job = beginCell()
            .storeBuffer(Buffer.from(session.wallet.appPublicKey, 'base64'))
            .storeUint(expires, 32)
            .storeCoins(0)
            .storeRef(beginCell()
                .storeAddress(address)
                .storeCoins(value)
                .storeStringRefTail(commentMsg)
                .storeMaybeRef(data ? data : null)
                .storeMaybeRef(stateInit ? stateInit : null)
                .endCell())
            .endCell()

        // Sign
        let keypair = keyPairFromSeed(Buffer.from(request.seed, 'base64'));
        let signature = safeSign(job, keypair.secretKey);

        // Create package
        let pkg = beginCell()
            .storeBuffer(signature)
            .storeBuffer(keypair.publicKey)
            .storeRef(job)
            .endCell();
        let boc = pkg.toBoc({ idx: false }).toString('base64');

        // Post command
        await backoff(() => this.transport.call('command_new', {
            job: boc,
        }));

        // Await result
        let result = await this._awaitJobState(request.appPublicKey, boc);
        if (result.type === 'completed') {
            return { type: 'success', response: result.result };
        } else if (result.type === 'rejected') {
            return { type: 'rejected' };
        }
        return { type: 'expired' };
    }

    requestSign = async (request: TonhubSignRequest): Promise<TonhubSignResponse> => {

        const sessionId = idFromSeed(request.seed);

        // Check session
        let session = await backoff(() => this.getSessionState(sessionId));
        if (session.state !== 'ready') {
            return { type: 'invalid_session' };
        }
        if (session.wallet.appPublicKey !== request.appPublicKey) {
            return { type: 'invalid_session' };
        }

        // Parse data
        let data: Cell = new Cell();
        if (typeof request.payload === 'string') {
            data = Cell.fromBoc(Buffer.from(request.payload, 'base64'))[0];
        }

        // Comment
        let commentMsg: string = '';
        if (typeof request.text === 'string') {
            commentMsg = request.text;
        }

        // Prepare cell
        let expires = Math.floor((Date.now() + request.timeout) / 1000);
        let commentCell = comment(commentMsg);
        const job = beginCell()
            .storeBuffer(Buffer.from(session.wallet.appPublicKey, 'base64'))
            .storeUint(expires, 32)
            .storeCoins(1)
            .storeRef(beginCell()
                .storeRef(commentCell)
                .storeRef(data)
                .endCell())
            .endCell();

        // Sign
        let keypair = keyPairFromSeed(Buffer.from(request.seed, 'base64'));
        let signature = safeSign(job, keypair.secretKey);

        // Create package
        let pkg = beginCell()
            .storeBuffer(signature)
            .storeBuffer(keypair.publicKey)
            .storeRef(job)
            .endCell();
        let boc = pkg.toBoc({ idx: false }).toString('base64');


        // Post command
        await backoff(() => this.transport.call('command_new', {
            job: boc,
        }));

        // Await result
        let result = await this._awaitJobState(request.appPublicKey, boc);
        if (result.type === 'completed') {
            const cellRes = Cell.fromBoc(Buffer.from(result.result, 'base64'))[0];
            let slice = cellRes.beginParse();
            const resSignature = slice.loadBuffer(64);
            let correct = verifySignatureResponse({
                signature: resSignature.toString('base64'),
                config: session.wallet,
                payload: request.payload,
                text: request.text,
            });

            if (correct) {
                return { type: 'success', signature: resSignature.toString('base64') };
            } else {
                return { type: 'rejected' };
            }
        } else if (result.type === 'rejected') {
            return { type: 'rejected' };
        }
        return { type: 'expired' };
    }

    private _awaitJobState = async (appPublicKey: string, boc: string): Promise<{ type: 'completed', result: string } | { type: 'rejected' | 'expired' }> => {
        return await backoff(async (): Promise<{ type: 'completed', result: string } | { type: 'rejected' | 'expired' }> => {
            while (true) {
                let state = await this._getJobState(appPublicKey, boc);
                if (state.type === 'expired') {
                    return { type: 'expired' };
                }
                if (state.type === 'completed') {
                    return { type: 'completed', result: state.result };
                }
                if (state.type === 'rejected') {
                    return { type: 'rejected' };
                }
                await delay(1000);
            }
        });
    }

    private _getJobState = async (appPublicKey: string, boc: string): Promise<{ type: 'expired' | 'rejected' | 'submitted' } | { type: 'completed', result: string }> => {
        let appk = toUrlSafe(appPublicKey);

        let res = await this.transport.call('command_get', { appk }) as JobState;

        if (res.state === 'empty') {
            return { type: 'expired' };
        }
        if (res.job !== boc) {
            return { type: 'rejected' };
        }
        if (res.state === 'expired') {
            return { type: 'expired' };
        }
        if (res.state === 'submitted') {
            return { type: 'submitted' };
        }
        if (res.state === 'rejected') {
            return { type: 'rejected' };
        }
        if (res.state === 'completed') {
            return { type: 'completed', result: res.result };
        }
        throw Error('Invalid response from server');
    };
}