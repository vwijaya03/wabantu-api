import {
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ConnectChannelDto {
  @IsEnum(['meta_cloud', 'baileys'])
  provider!: 'meta_cloud' | 'baileys';

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  displayName!: string;

  @IsString()
  @Matches(/^\+?[0-9]{8,20}$/, {
    message: 'Nomor WhatsApp harus dalam format E.164',
  })
  phoneNumber!: string;

  /** Long-lived Meta access token (only for meta_cloud). */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  accessToken?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  metaPhoneNumberId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  metaWabaId?: string;
}
