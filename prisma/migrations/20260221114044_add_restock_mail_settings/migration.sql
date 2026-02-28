-- AlterTable
ALTER TABLE "EmailSetting" ADD COLUMN     "restockBody" TEXT NOT NULL DEFAULT 'ご登録いただいた商品「{{product_name}}」が再入荷いたしました。数に限りがございますので、お早めにご確認ください。',
ADD COLUMN     "restockSubject" TEXT NOT NULL DEFAULT '【再入荷のお知らせ】お待たせいたしました！';
