import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class MetaConnectCallbackDto {
  @IsString()
  @MinLength(6)
  @MaxLength(2048)
  code!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(256)
  state!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  displayName!: string;

  @IsString()
  @Matches(/^\+?[0-9]{8,20}$/, {
    message: 'Nomor WhatsApp harus dalam format E.164',
  })
  phoneNumber!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  metaPhoneNumberId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  metaWabaId?: string;
}
