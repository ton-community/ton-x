import { walletV4FromConfig } from "./walletV4FromConfig";

export function extractPublicKeyAndAddress(config: {
    walletType: string,
    walletConfig: string
}) {
    if (config.walletType === 'org.ton.wallets.v4') {
        let source = walletV4FromConfig(config.walletConfig);

        return {
            publicKey: source.publicKey,
            address: source.address,
        }
    } else {
        return null;
    }
}
