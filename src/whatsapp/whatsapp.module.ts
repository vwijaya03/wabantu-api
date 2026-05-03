import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantCompany } from '../database/system/entities/tenant-company.entity';
import { MetaCloudProvider } from './providers/meta-cloud.provider';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappService } from './whatsapp.service';

@Module({
  imports: [TypeOrmModule.forFeature([TenantCompany])],
  controllers: [WhatsappController],
  providers: [WhatsappService, MetaCloudProvider],
  exports: [WhatsappService],
})
export class WhatsappModule {}
