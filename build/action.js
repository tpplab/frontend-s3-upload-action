import { createReadStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { lookup } from 'mime-types';
import { S3Client, ListObjectsCommand, PutObjectCommand, DeleteObjectsCommand, } from '@aws-sdk/client-s3';
import { YANDEX_CLOUD_REGION, YANDEX_CLOUD_ENDPOINT, } from './types.js';
export class Action {
    inputs;
    logger;
    s3Client;
    constructor(inputs, logger) {
        this.inputs = inputs;
        this.logger = logger;
        this.s3Client = new S3Client({
            credentials: {
                accessKeyId: this.inputs.accessKeyId,
                secretAccessKey: this.inputs.secretAccessKey,
            },
            region: YANDEX_CLOUD_REGION,
            endpoint: YANDEX_CLOUD_ENDPOINT,
        });
    }
    async run() {
        if (this.inputs.clear) {
            await this.clearBucket(this.inputs.bucket);
            this.logger('Bucket was cleaned successfully');
        }
        for await (const fileName of this.getFilesNames(this.inputs.folderPath)) {
            this.logger(`Uploading: ${fileName} ...`);
            await this.uploadFile(this.inputs.bucket, this.inputs.folderPath, fileName);
        }
        this.logger('Done');
    }
    async *getFilesNames(folderPath) {
        const dirents = await readdir(folderPath, { withFileTypes: true });
        for (const dirent of dirents) {
            const result = resolve(folderPath, dirent.name);
            if (dirent.isDirectory()) {
                yield* this.getFilesNames(result);
            }
            else {
                yield relative(this.inputs.folderPath, result);
            }
        }
    }
    async uploadFile(bucket, folderPath, fileName) {
        const filePath = resolve(folderPath, fileName);
        const fileType = lookup(filePath) || 'text/plain';
        const putCommand = new PutObjectCommand({
            Key: fileName,
            Bucket: bucket,
            Body: createReadStream(filePath),
            ContentType: fileType,
        });
        return this.s3Client.send(putCommand);
    }
    async clearBucket(bucket) {
        const listCommand = new ListObjectsCommand({ Bucket: bucket });
        const listedObjects = await this.s3Client.send(listCommand);
        if (!listedObjects.Contents || listedObjects.Contents.length === 0) {
            return;
        }
        const deleteKeys = listedObjects.Contents.filter((content) => content.Key !== 'maintenance.html').map((content) => ({ Key: content.Key }));
        const deleteCommand = new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: deleteKeys },
        });
        await this.s3Client.send(deleteCommand);
        if (listedObjects.IsTruncated) {
            await this.clearBucket(bucket);
        }
    }
}
