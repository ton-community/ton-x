import * as t from 'io-ts';
import { Address, beginCell, Cell, CommentMessage, safeSignVerify } from 'ton';
import { extractPublicKeyAndAddress } from '../contracts/extractPublicKeyAndAddress';

const configCodec = t.type({
    version: t.literal(1),
    platform: t.union([t.literal('ios'), t.literal('android')]),
    platformVersion: t.union([t.string, t.number]),
    network: t.union([t.literal('testnet'), t.literal('mainnet')]),
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
    network: 'testnet' | 'mainnet',
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

export type TonhubLocalSignRequest = {
    text?: string | null | undefined,
    payload?: string | null | undefined
}

export type TonhubLocalSignResponse = {
    type: 'success',
    signature: string
} | {
    type: 'rejected'
};

export class TonhubLocalConnector {

    static verifyWalletConfig(config: {
        address: string,
        walletConfig: string,
        walletType: string,
        time: number,
        signature: string,
        subkey: {
            domain: string,
            publicKey: string,
            time: number,
            signature: string
        }
    }) {

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

        // Verify subkey
        const toSignSub = beginCell()
            .storeCoins(1)
            .storeBuffer(Buffer.from(config.subkey.publicKey, 'base64'))
            .storeUint(config.subkey.time, 32)
            .storeAddress(extracted.address)
            .storeRef(beginCell()
                .storeBuffer(Buffer.from(config.subkey.domain))
                .endCell())
            .endCell();
        if (!safeSignVerify(toSignSub, Buffer.from(config.subkey.signature, 'base64'), extracted.publicKey)) {
            return false;
        }

        // Verify wallet
        const toSign = beginCell()
            .storeCoins(1)
            .storeAddress(extracted.address)
            .storeUint(config.time, 32)
            .storeRef(beginCell()
                .storeBuffer(Buffer.from(config.subkey.domain))
                .endCell())
            .endCell();

        // Check signature
        return safeSignVerify(toSign, Buffer.from(config.signature, 'base64'), Buffer.from(config.subkey.publicKey, 'base64'));
    }

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

    readonly network: 'mainnet' | 'testnet';
    readonly config: TonhubLocalConfig;

    #provider: (name: string, args: any, callback: (res: any) => void) => void;

    constructor(network: 'mainnet' | 'testnet') {
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

    async requestSign(request: TonhubLocalSignRequest): Promise<TonhubLocalSignResponse> {

        // Parse data
        let data: Cell = new Cell();
        if (typeof request.payload === 'string') {
            data = Cell.fromBoc(Buffer.from(request.payload, 'base64'))[0];
        }

        // Comment
        let comment: string = '';
        if (typeof request.text === 'string') {
            comment = request.text;
        }
        let commentCell = new Cell();
        new CommentMessage(comment).writeTo(commentCell);

        let res = await this.#doRequest('sign', {
            network: this.network,
            textCell: commentCell.toBoc({ idx: false }).toString('base64'),
            payloadCell: data.toBoc({ idx: false }).toString('base64')
        });
        if (res.type === 'ok') {
            let d = res.data;
            if (d.state === 'rejected') {
                return { type: 'rejected' };
            }
            if (d.state === 'sent') {
                return { type: 'success', signature: d.result };
            }
            throw Error('Unknown reponse');
        }
        throw Error(res.message);
    }

    async #doRequest(name: string, args: any) {
        return await new Promise<any>((resolve) => this.#provider(name, args, resolve));
    }
}