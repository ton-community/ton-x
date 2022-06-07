
export class TonXTransport implements Transport {
    call<TResult, TArgs>(method: string, args: TArgs): Promise<TResult> {
        let tonX = TonXTransport.getTonX();
        if (!tonX) {
            throw new Error('ton-x not found');
        }
        
        return tonX.call(method, args);
    }

    private static getTonX() {
        if (!window || !(window as any).tonX) {
            return null;
        }
    
        return window && (window as any).tonX as {
            call: <TResult, TPayload>(type: string, payload: TPayload) => Promise<TResult>
        };
    }

    static isAvailable() {
        return this.getTonX() !== null;
    }
}