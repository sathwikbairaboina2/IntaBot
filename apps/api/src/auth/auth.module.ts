import { Global, Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthGuard } from "./auth.guard";
import { PasswordService } from "./password.service";
import { SessionService } from "./session.service";
import { UserRepository } from "./user.repository";

@Global()
@Module({
  controllers: [AuthController],
  providers: [UserRepository, PasswordService, SessionService, AuthGuard],
  exports: [UserRepository, PasswordService, SessionService, AuthGuard],
})
export class AuthModule {}
