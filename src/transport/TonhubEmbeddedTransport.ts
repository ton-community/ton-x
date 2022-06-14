
export class TonhubEmbeddedTransport implements Transport {
    call<TResult, TArgs>(method: string, args: TArgs): Promise<TResult> {
        let tonX = TonhubEmbeddedTransport.get();
        if (!tonX) {
            throw new Error('ton-x not found');
        }
        
        return tonX.call(method, args);
    }

    private static get() {
        if (typeof window === 'undefined' || !(window as any)?.tonX) {
            return null;
        }
    
        return window && (window as any).tonX as {
            call: <TResult, TPayload>(type: string, payload: TPayload) => Promise<TResult>
        };
    }

    static isAvailable() {
        return this.get() !== null;
    }
}