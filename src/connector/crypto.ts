import { Address, beginCell, Cell, safeSignVerify, comment } from "ton-core";
import { extractPublicKeyAndAddress } from "../contracts/extractPublicKeyAndAddress";

export function verifySignatureResponse(args: {
    signature: string,
    text?: string | null | undefined,
    payload?: string | null | undefined,
    config: { address: string, walletType: string, walletConfig: string }
}) {
    // Check address
    const address = Address.parseFriendly(args.config.address).address;

    // Extract public key and address
    let extracted = extractPublicKeyAndAddress(args.config);
    if (!extracted) {
        return false;
    }

    // Check address
    if (!extracted.address.equals(address)) {
        return false;
    }

    let publicKey: Buffer = extracted.publicKey;

    // Package
    let textCell = args.text ? comment(args.text) : Cell.EMPTY;
    let payloadCell = Cell.EMPTY;
    if (typeof args.payload === 'string') {
        payloadCell = Cell.fromBoc(Buffer.from(args.payload, 'base64'))[0];
    }

    // Check signature
    const data = beginCell()
        .storeRef(textCell)
        .storeRef(payloadCell)
        .endCell();
    const signed = safeSignVerify(data, Buffer.from(args.signature, 'base64'), publicKey);

    return signed;
}