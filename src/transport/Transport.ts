export interface Transport {
    call<TResult = any, TArgs = any>(method: string, args: TArgs): Promise<TResult>
}