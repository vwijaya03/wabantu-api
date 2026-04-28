import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class UpdateBusinessProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  businessName?: string;

  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() @MaxLength(500) address?: string;
  @IsOptional() @IsString() @MaxLength(500) openingHours?: string;
  @IsOptional() @IsString() @MaxLength(2000) productsServices?: string;
  @IsOptional() @IsString() @MaxLength(500) basePricing?: string;
  @IsOptional() @IsString() @MaxLength(500) deliveryArea?: string;
  @IsOptional() @IsString() @MaxLength(2000) greetingTemplate?: string;

  @IsOptional()
  @IsEnum(['friendly', 'formal', 'casual'])
  tone?: 'friendly' | 'formal' | 'casual';

  @IsOptional()
  @IsBoolean()
  aiEnabled?: boolean;
}
