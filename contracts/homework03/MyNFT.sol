// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract MyNFT is ERC721,ERC721URIStorage,Ownable {
    uint256 private _nextTokenId = 1;
    event Minted(address indexed to, uint256 indexed tokenId, string uri);
    constructor() ERC721("Homework Auction NFT","HWNFT") Ownable(msg.sender) {}
        function mint(address to, string calldata uri) external onlyOwner returns (uint256 tokenId) {
            tokenId = _nextTokenId;
            _nextTokenId += 1;
            _safeMint(to, tokenId);
            _setTokenURI(tokenId, uri);
            emit Minted(to, tokenId, uri);
            return tokenId;
        }

        function totalMinted() external view returns (uint256) {
            return _nextTokenId - 1;
        }

        function tokenURI(uint256 tokenId) public view override(ERC721, ERC721URIStorage) returns (string memory) {
            return super.tokenURI(tokenId);
        }

        function supportsInterface(bytes4 interfaceId) public view override(ERC721, ERC721URIStorage) returns (bool) {
            return super.supportsInterface(interfaceId);
        }
}
