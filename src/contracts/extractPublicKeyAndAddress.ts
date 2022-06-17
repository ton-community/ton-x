import { Address, contractAddress } from "ton";
import { WalletV4Source } from "./WalletV4Source";

export function extractPublicKeyAndAddress(config: {
    walletType: string,
    walletConfig: string
}) {
    // Extract public key and address
    let publicKey: Buffer;
    let restoredAddress: Address;
    if (config.walletType === 'org.ton.wallets.v4') {
        let source = WalletV4Source.restore(config.walletConfig);
        restoredAddress = contractAddress(source);
        publicKey = source.publicKey;
    } else {
        return null;
    }

    // Public key
    return { publicKey, address: restoredAddress };
}
