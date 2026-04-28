import { Module } from '@nestjs/common';
import { MetaCloudProvider } from './providers/meta-cloud.provider';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappService } from './whatsapp.service';

@Module({
  controllers: [WhatsappController],
  providers: [WhatsappService, MetaCloudProvider],
  exports: [WhatsappService],
})
export class WhatsappModule {}
