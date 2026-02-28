-- CreateTable
CREATE TABLE "Favorite" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "productId" TEXT,
    "productHandle" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Favorite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailSetting" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "senderName" TEXT NOT NULL DEFAULT 'ショップ名事務局',
    "subject" TEXT NOT NULL DEFAULT '入荷通知設定を承りました',
    "body" TEXT NOT NULL DEFAULT '商品「{{product_name}}」の入荷通知設定を承りました。入荷次第、本メールアドレスへご連絡いたします。',
    "isRestockEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Favorite_shop_customerId_productHandle_key" ON "Favorite"("shop", "customerId", "productHandle");

-- CreateIndex
CREATE UNIQUE INDEX "EmailSetting_shop_key" ON "EmailSetting"("shop");
