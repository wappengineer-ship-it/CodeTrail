ALTER TABLE "Technology" ADD COLUMN "userId" TEXT;

UPDATE "Technology"
SET "userId" = (SELECT "id" FROM "User" ORDER BY "createdAt" ASC LIMIT 1)
WHERE "userId" IS NULL;

ALTER TABLE "Technology" ALTER COLUMN "userId" SET NOT NULL;

DROP INDEX IF EXISTS "Technology_name_key";

CREATE UNIQUE INDEX "Technology_userId_name_key" ON "Technology"("userId", "name");

ALTER TABLE "Technology"
  ADD CONSTRAINT "Technology_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
