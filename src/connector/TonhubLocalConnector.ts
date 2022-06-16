import * as t from 'io-ts';

const configCodec = t.type({
    version: t.literal(1),
    platform: t.union([t.literal('ios'), t.literal('android')]),
    platformVersion: t.union([t.string, t.number]),
    network: t.union([t.literal('sandbox'), t.literal('mainnet')]),
    address: t.string,
    publicKey: t.string,
    walletConfig: t.string,
    walletType: t.string,
    signature: t.string,
    time: t.number,
    subkey: t.type({
        domain: t.string,
        publicKey: t.string,
        time: t.number,
        signature: t.string
    })
});

export type TonhubLocalConfig = {
    version: number,
    network: 'sandbox' | 'mainnet',
    address: string,
    publicKey: string,
    walletConfig: string,
    walletType: string,
    signature: string,
    time: number,
    subkey: {
        domain: string,
        publicKey: string,
        time: number,
        signature: string
    }
};

export type TonhubLocalTransactionRequest = {
    to: string,
    value: string,
    stateInit?: string | null | undefined,
    text?: string | null | undefined,
    payload?: string | null | undefined
};

export type TonhubLocalTransactionResponse = {
    type: 'success',
    response: string
} | {
    type: 'rejected'
};

export class TonhubLocalConnector {

    static isAvailable() {
        if (typeof window === 'undefined') {
            return false;
        }
        if (!((window as any)['ton-x'])) {
            return false;
        }
        let tx = ((window as any)['ton-x']);
        if (tx.__IS_TON_X !== true) {
            return false;
        }
        if (!configCodec.is(tx.config)) {
            return false;
        }
        return true;
    }

    readonly network: 'mainnet' | 'sandbox';
    readonly config: TonhubLocalConfig;

    #provider: (name: string, args: any, callback: (res: any) => void) => void;

    constructor(network: 'mainnet' | 'sandbox') {
        if (typeof window === 'undefined') {
            throw Error('Not running in browser');
        }
        if (!((window as any)['ton-x'])) {
            throw Error('Not running in dApp browser');
        }
        let tx = ((window as any)['ton-x']);
        if (tx.__IS_TON_X !== true) {
            throw Error('Not running in dApp browser');
        }
        let cfg = tx.config;
        if (!configCodec.is(cfg)) {
            throw Error('Not running in dApp browser');
        }
        if (cfg.network !== network) {
            throw Error('Invalid network');
        }
        this.network = network;
        this.config = {
            version: cfg.version,
            network: cfg.network,
            address: cfg.address,
            publicKey: cfg.publicKey,
            walletConfig: cfg.walletConfig,
            walletType: cfg.walletType,
            signature: cfg.signature,
            time: cfg.time,
            subkey: {
                domain: cfg.subkey.domain,
                publicKey: cfg.subkey.publicKey,
                time: cfg.subkey.time,
                signature: cfg.subkey.signature
            }
        };
        this.#provider = tx.call;
        Object.freeze(this.config.subkey);
        Object.freeze(this.config);
        Object.freeze(this);
    }

    async requestTransaction(request: TonhubLocalTransactionRequest): Promise<TonhubLocalTransactionResponse> {
        let res = await this.#doRequest('tx', {
            network: this.network,
            to: request.to,
            value: request.value,
            stateInit: request.stateInit ? request.stateInit : null,
            text: request.text ? request.text : null,
            payload: request.payload ? request.payload : null,
        });
        if (res.type === 'ok') {
            let d = res.data;
            if (d.state === 'rejected') {
                return { type: 'rejected' };
            }
            if (d.state === 'sent') {
                return { type: 'success', response: d.result };
            }
            throw Error('Unknown reponse');
        }
        throw Error(res.message);
    }

    async #doRequest(name: string, args: any) {
        return await new Promise<any>((resolve) => this.#provider(name, args, resolve));
    }
}