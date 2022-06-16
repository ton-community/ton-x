import axios from 'axios';

export class TonhubHttpTransport implements Transport {
    private readonly _endpoint: string;
    private readonly _timeout: number;

    private adapter?: any;

    constructor(config?: { endpoint?: string, adapter?: any, timeout?: number }) {
        this._endpoint = config?.endpoint || 'https://connect.tonhubapi.com';
        this._timeout = config?.timeout || 5000;
        this.adapter = config?.adapter;
    }

    private getAxiosConfig() {
        return this.adapter ? { timeout: this._timeout, adapter: this.adapter } : { timeout: this._timeout };
    }

    call(method: string, args: any): Promise<any> {
        if (method === 'session_new') {
            return this.createSession(args);
        } else if (method === 'session_get') {
            return this.getSession(args);
        } else if (method === 'session_wait') {
            return this.waitSession(args);
        } else if (method === 'command_new') {
            return this.createCommand(args);
        } else if (method === 'command_get') {
            return this.getCommand(args);
        } else {
            throw new Error('Unsupported method');
        }
    }
    
    async createSession(args: any) {
        let session = await axios.post(
            `${this._endpoint}/connect/init`, 
            args,
            this.getAxiosConfig(),
        );
        return session.data;
    }

    async getSession(args: { id: string }) {
        if (!args.id) {
            throw new Error('Invalid session id');
        }
        
        let session = await axios.get(
            `${this._endpoint}/connect/` + args.id, 
            this.getAxiosConfig()
        );
        return session.data;
    }

    async waitSession(args: { id: string, lastUpdated?: number }) {
        if (!args.id) {
            throw new Error('Invalid session id');
        }
        
        let session = await axios.get(
            `${this._endpoint}/connect/` + args.id + '/wait?lastUpdated='+(args.lastUpdated || 0), 
            { ...this.getAxiosConfig(), timeout: 30000 }
        );
        return session.data;
    }

    async createCommand(args: any) {
        let result = await axios.post(`${this._endpoint}/connect/command`, args, this.getAxiosConfig());
        return result.data;
    }
    async getCommand(args: { appk: string }) {
        return (await axios.get(`${this._endpoint}/connect/command/` + args.appk, this.getAxiosConfig())).data;
    }
}