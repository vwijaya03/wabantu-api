import { Module } from '@nestjs/common';
import { MetaCloudProvider } from '../whatsapp/providers/meta-cloud.provider';
import { InboxController } from './inbox.controller';
import { InboxService } from './inbox.service';

@Module({
  controllers: [InboxController],
  providers: [InboxService, MetaCloudProvider],
  exports: [InboxService],
})
export class InboxModule {}
