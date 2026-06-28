// vpn.service.ts
import { Injectable } from '@nestjs/common';
import axios from 'axios';
import * as https from 'https';

@Injectable()
export class VpnService {
  private readonly OUTLINE_API = process.env.OUTLINE_API_URL;
  private readonly SERVER_IP = process.env.VULTR_SERVER_IP;
  private readonly DOMAIN = process.env.VPN_DOMAIN;

  private httpsAgent = new https.Agent({ rejectUnauthorized: false });

  async generateKey(
    telegramUsername: string,
  ): Promise<{ success: boolean; keyUrl?: string; error?: string }> {
    try {
      const createRes = await axios.post(
        `${this.OUTLINE_API}/access-keys`,
        {},
        { httpsAgent: this.httpsAgent },
      );
      const keyId = createRes.data.id;
      const rawAccessUrl = createRes.data.accessUrl;

      // Key ကို User နာမည်ပေးခြင်း (Tracking အတွက်)
      await axios.put(
        `${this.OUTLINE_API}/access-keys/${keyId}/name`,
        { name: telegramUsername },
        { httpsAgent: this.httpsAgent },
      );

      // IP နေရာမှာ Domain နဲ့ အစားထိုးခြင်း
      const domainKey = rawAccessUrl.replaceAll(this.SERVER_IP, this.DOMAIN);

      return { success: true, keyUrl: domainKey };
    } catch (error) {
      console.error('Outline API Error:', error.message);
      return { success: false, error: 'Outline API error' };
    }
  }
}
