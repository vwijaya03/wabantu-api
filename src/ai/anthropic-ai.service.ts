import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AiConfig } from '../config/configuration';

@Injectable()
export class AnthropicAiService {
  private readonly logger = new Logger(AnthropicAiService.name);
  private readonly client: Anthropic | null;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(config: ConfigService) {
    const ai = config.getOrThrow<AiConfig>('ai');
    this.model = ai.anthropicModel;
    this.maxTokens = ai.anthropicMaxTokens;
    this.client = ai.anthropicApiKey
      ? new Anthropic({ apiKey: ai.anthropicApiKey })
      : null;
  }

  async generateReply(input: {
    system: string;
    business: string;
    kb: string;
    history: string;
    userMessage: string;
  }): Promise<string> {
    if (!this.client) {
      throw new Error('ANTHROPIC_API_KEY belum diatur');
    }
    this.logger.log(
      `Anthropic generateReply model=${this.model} maxTokens=${this.maxTokens} sizes sys=${input.system.length} business=${input.business.length} kb=${input.kb.length} hist=${input.history.length} userMsgLen=${input.userMessage.length}`,
    );
    const prompt = [
      'Konteks bisnis:',
      input.business,
      '',
      input.kb,
      '',
      input.history,
      '',
      `Pesan pelanggan terbaru: ${input.userMessage}`,
      'Tugas: berikan satu balasan WhatsApp yang aman dan membantu.',
    ].join('\n');

    let res: Awaited<ReturnType<Anthropic['messages']['create']>>;
    try {
      res = await this.client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        temperature: 0.3,
        system: input.system,
        messages: [{ role: 'user', content: prompt }],
      });
    } catch (err) {
      this.logger.error(
        {
          err: (err as Error).message,
        },
        'Anthropic messages.create failed',
      );
      throw err;
    }
    const text = res.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n')
      .trim();
    if (!text) {
      this.logger.warn('Anthropic returned empty completion');
      throw new Error('AI response kosong');
    }
    this.logger.log(`Anthropic completion received len=${text.length}`);
    return text.slice(0, 1200);
  }
}
