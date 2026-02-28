import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  const { admin } = await authenticate.public.appProxy(request);
  if (!admin) return { error: "Unauthorized" };

  try {
    const { customerId, productHandle } = await request.json();
    
    const response = await admin.graphql(
      `query get($id: ID!) { customer(id: $id) { wishlist: metafield(namespace: "custom", key: "wishlist") { value } } }`,
      { variables: { id: `gid://shopify/Customer/${customerId}` } }
    );

    const resJson = await response.json();
    let wishlist = resJson.data.customer?.wishlist?.value ? JSON.parse(resJson.data.customer.wishlist.value) : [];
    wishlist = wishlist.filter(id => id !== productHandle);

    await admin.graphql(
      `mutation set($input: MetafieldsSetInput!) { metafieldsSet(metafields: [$input]) { userErrors { message } } }`,
      {
        variables: {
          input: {
            namespace: "custom",
            key: "wishlist",
            ownerId: `gid://shopify/Customer/${customerId}`,
            type: "list.product_reference",
            value: JSON.stringify(wishlist),
          },
        },
      }
    );

    return { success: true };
  } catch (err) {
    return { error: "Remove Error" };
  }
};