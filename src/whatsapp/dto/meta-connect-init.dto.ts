import { IsString, IsUrl, MaxLength } from 'class-validator';

export class MetaConnectInitDto {
  @IsString()
  @IsUrl({ require_tld: false }, { message: 'redirectUri harus URL valid' })
  @MaxLength(2048)
  redirectUri!: string;

  @IsString()
  @MaxLength(64)
  metaAppId!: string;

  @IsString()
  @MaxLength(512)
  metaAppSecret!: string;
}
