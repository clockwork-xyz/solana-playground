import {
  JsonMetadata,
  toMetaplexFileFromBrowser,
  UploadMetadataInput,
} from "@metaplex-foundation/js";

import { Emoji } from "../../../../../../constants";
import { PgCommon } from "../../../../common";
import { PgConnection } from "../../../../connection";
import { PgTerminal } from "../../../../terminal";
import { getConfigData, getMetaplex, loadCache } from "../../utils";
import { getAssetPairs } from "./assets";

interface AssetType {
  image: number[];
  metadata: number[];
  animation: number[];
}

export const processUpload = async (rpcUrl: string = PgConnection.endpoint) => {
  const configData = await getConfigData();
  const term = await PgTerminal.get();

  term.println(`[1/3] ${Emoji.ASSETS} Loading assets`);

  // Get asset pairs
  const { assetPairs, files } = await getAssetPairs();

  // Create/load cache
  const cache = await loadCache();

  // List of indices to upload
  const indices: AssetType = {
    image: [],
    metadata: [],
    animation: [],
  };

  for (const [index, pair] of assetPairs) {
    const item = cache.items[index];

    if (item) {
      const imageChanged =
        item.image_hash !== pair.image_hash || !item.image_link;

      const animationChanged =
        item.animation_hash !== pair.animation_hash ||
        (!item.animation_link && pair.animation);

      const metadataChanged =
        item.metadata_hash !== pair.metadata_hash || !item.metadata_link;

      if (imageChanged) {
        // Triggers the image upload
        item.image_hash = pair.image_hash;
        item.image_link = "";
        indices.image.push(index);
      }

      if (animationChanged) {
        // Triggers the animation upload
        item.animation_hash = pair.animation_hash;
        item.animation_link = undefined;
        indices.animation.push(index);
      }

      if (metadataChanged || imageChanged || animationChanged) {
        // Triggers the metadata upload
        item.metadata_hash = pair.metadata_hash;
        item.metadata_link = "";
        item.onChain = false;
        // We need to upload metadata only
        indices.metadata.push(index);
      }
    } else {
      cache.items[index] = pair.intoCacheItem();
      // We need to upload both image/metadata
      indices.image.push(index);
      indices.metadata.push(index);
      // And we might need to upload the animation
      if (pair.animation) {
        indices.animation.push(index);
      }
    }

    // Sanity check: verifies that both symbol and seller-fee-basis-points are the
    // same as the ones in the config file
    const currentFile = files.find((f) => f.name === pair.metadata);
    if (!currentFile)
      throw new Error(`Metadata file ${pair.metadata} not found.`);
    const metadata: JsonMetadata = JSON.parse(await currentFile.text());

    // Symbol check, but only if the asset actually has the value
    if (metadata.symbol && configData.symbol !== metadata.symbol) {
      throw new Error(
        `Mismatch between symbols in config file and metadata file. '${configData.symbol}' != '${metadata.symbol}'`
      );
    }

    // Seller fee basis points check, but only if the asset actually has the value
    if (
      metadata.sellerFeeBasisPoints &&
      configData.sellerFeeBasisPoints !== metadata.sellerFeeBasisPoints
    ) {
      throw new Error(
        `Mismatch between sellerFeeBasisPoints in config file and metadata file. ${configData.sellerFeeBasisPoints} != ${metadata.sellerFeeBasisPoints}`
      );
    }
  }

  term.println(`Found ${assetPairs.length} asset pair(s), uploading files:`);

  term.println("+--------------------+");
  term.println(
    `| images    | ${PgCommon.addSpace(indices.image.length.toString(), 6)} |`
  );
  term.println(
    `| metadata  | ${PgCommon.addSpace(
      indices.metadata.length.toString(),
      6
    )} |`
  );

  if (indices.animation.length) {
    term.println(
      `| animation    | ${PgCommon.addSpace(
        indices.animation.length.toString(),
        6
      )} |`
    );
  }
  term.println("+--------------------+");

  // This should never happen, since every time we update the image file we
  // need to update the metadata
  if (indices.image.length > indices.metadata.length) {
    throw new Error(
      `There are more image files (${indices.image.length}) to upload than metadata (${indices.metadata.length})`
    );
  }

  const needUpload =
    indices.image.length || indices.metadata.length || indices.animation.length;

  // Ready to upload data
  if (needUpload) {
    term.println(`\n[2/3] ${Emoji.COMPUTER} Initializing upload`);

    // Initialize storage
    const metaplex = await getMetaplex(rpcUrl);

    // Uploadin files
    term.println(
      `\n[3/3] ${Emoji.UPLOAD} Uploading files ${
        !indices.metadata.length ? "(skipping)" : ""
      }`
    );
    for (const i of indices.metadata) {
      const metadataIndex = i !== -1 ? 2 * i : files.length - 2;
      const metadata: UploadMetadataInput = JSON.parse(
        await files[metadataIndex].text()
      );
      const imgMetaplexFile = await toMetaplexFileFromBrowser(
        files[metadataIndex + 1]
      );
      // Edit
      metadata.image = imgMetaplexFile;
      if (metadata.properties?.files) {
        for (const j in metadata.properties.files) {
          metadata.properties.files[j] = {
            ...metadata.properties.files[j],
            // TODO: handle animations
            uri: imgMetaplexFile,
          };
        }
      }

      const { uri, metadata: resultMetadata } = await metaplex
        .nfts()
        .uploadMetadata(metadata)
        .run();

      // Update and save cache
      cache.updateItemAtIndex(i, {
        image_link: resultMetadata.image,
        metadata_link: uri,
      });
      await cache.syncFile();
    }

    await cache.syncFile(true);
  } else {
    term.println("\n...no files need uploading, skipping remaining steps.");
  }

  // Sanity check
  let count = 0;

  for (const i in cache.items) {
    const item = cache.items[i];

    const assetPair = assetPairs.find((ap) => ap[0] === parseInt(i))?.[1];
    if (!assetPair) throw new Error(`Asset pair at index ${i} not found.`);

    // We first check that the asset has an animation file; if there is one,
    // we need to check that the cache item has the link and the link is not empty
    const missingAnimationLink = assetPair.animation && !item.animation_link;

    // Only increment the count if the cache item is complete (all links are present)
    if (!(!item.image_link || !item.metadata_link || missingAnimationLink)) {
      count++;
    }
  }

  term.println(
    PgTerminal.bold(`\n${count}/${assetPairs.length} asset pair(s) uploaded.`)
  );

  if (count !== assetPairs.length) {
    throw new Error("Not all files were uploaded.");
  }
};